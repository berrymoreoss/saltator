// A 16-byte FIFO: its buffer is a memory, its pointers flip-flops (HDL-6).
module mem_fifo (input clk, rst, push, pop, input [7:0] din,
                 output [7:0] dout, output empty, full);
  reg [7:0] buffer[0:15];
  reg [4:0] wp = 0, rp = 0;
  assign empty = wp == rp;
  assign full = wp[3:0] == rp[3:0] && wp[4] != rp[4];
  assign dout = buffer[rp[3:0]];
  always @(posedge clk)
    if (rst) begin
      wp <= 0;
      rp <= 0;
    end else begin
      if (push && !full) begin
        buffer[wp[3:0]] <= din;
        wp <= wp + 1;
      end
      if (pop && !empty) rp <= rp + 1;
    end
endmodule
