// PicoRV32 with 4 KB of RAM, an input port and an output port: the Saltator example's module.
//
// Made into a module with (see README.md):
//   yosys -q -p 'read_verilog soc.v picorv32.v; hierarchy -top soc; proc -norom; flatten;
//     tribuf -logic; opt -keepdc; memory_collect; check; write_json soc.json'
//
// Memory map, on the core's native memory interface (upstream's README.md):
//   0x0000_0000-0x0000_0FFF  RAM, 1024 words: the program from address 0 (firmware.hex), the
//                            stack at the top
//   0x1000_0000              out: a write sets the output port from bits 7..0
//   0x1000_0004              in: a read gives the input port in bits 7..0
// Every access takes one cycle, as in upstream's testbench: mem_ready the cycle after mem_valid.
// Other addresses read 0 and ignore writes.
module soc (
  input clk,
  input resetn,           // low: the core resets (and once by itself at power-up)
  input [7:0] in,
  output reg [7:0] out = 0,
  output trap             // the core has stopped: EBREAK, an illegal instruction, a bad address
);
  // Power-on reset, as on an FPGA, whose flip-flops start from their initial values: the core
  // is held in reset for its first 8 clock cycles, then whenever resetn is low.
  reg [3:0] boot = 0;
  always @(posedge clk) if (!boot[3]) boot <= boot + 1;
  wire run = resetn && boot[3];

  wire mem_valid;
  wire mem_instr;
  reg mem_ready;
  wire [31:0] mem_addr;
  wire [31:0] mem_wdata;
  wire [3:0] mem_wstrb;
  reg [31:0] mem_rdata;

  picorv32 #(
    .ENABLE_COUNTERS(0),  // no RDCYCLE and RDINSTRET: fewer cells
    .BARREL_SHIFTER(1)    // a shift takes one cycle, not one per bit
  ) cpu (
    .clk(clk),
    .resetn(run),
    .trap(trap),
    .mem_valid(mem_valid),
    .mem_instr(mem_instr),
    .mem_ready(mem_ready),
    .mem_addr(mem_addr),
    .mem_wdata(mem_wdata),
    .mem_wstrb(mem_wstrb),
    .mem_rdata(mem_rdata)
  );

  reg [31:0] ram [0:1023];
  initial $readmemh("firmware.hex", ram);

  wire [9:0] word = mem_addr[11:2];

  // Nothing happens in reset. The core's mem_valid has no power-up value: at the first clock
  // edge it is unknown, and a write it might enable at an unknown address would make the whole
  // RAM unknown. A simulator where `if (x)` is false (Icarus) never shows it; a board might.
  always @(posedge clk) begin
    mem_ready <= 0;
    if (!run) begin
      out <= 0;
    end else if (mem_valid && !mem_ready) begin
      mem_ready <= 1;
      mem_rdata <= 0;
      if (mem_addr < 32'h0000_1000) begin
        mem_rdata <= ram[word];
        if (mem_wstrb[0]) ram[word][7:0] <= mem_wdata[7:0];
        if (mem_wstrb[1]) ram[word][15:8] <= mem_wdata[15:8];
        if (mem_wstrb[2]) ram[word][23:16] <= mem_wdata[23:16];
        if (mem_wstrb[3]) ram[word][31:24] <= mem_wdata[31:24];
      end else if (mem_addr == 32'h1000_0000) begin
        if (mem_wstrb[0]) out <= mem_wdata[7:0];
      end else if (mem_addr == 32'h1000_0004) begin
        mem_rdata <= {24'b0, in};
      end
    end
  end
endmodule
