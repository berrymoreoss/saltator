// Differential (HDL-6): an 8-byte FIFO — its buffer a memory, its pointers flip-flops.
module fifo8 (input clk, input rst, input push, input pop, input [7:0] din,
              output [7:0] dout, output empty, output full, output [3:0] count);
  reg [7:0] buffer[0:7];
  reg [3:0] wp, rp;
  assign count = wp - rp;
  assign empty = wp == rp;
  assign full = count == 8;
  assign dout = buffer[rp[2:0]];
  always @(posedge clk)
    if (rst) begin
      wp <= 0;
      rp <= 0;
    end else begin
      if (push && !full) begin
        buffer[wp[2:0]] <= din;
        wp <= wp + 1;
      end
      if (pop && !empty) rp <= rp + 1;
    end
endmodule
