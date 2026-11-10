// HDL-9: power-up values from init — a toggling register, a counter from 5, an output register;
// a register without one starts unknown.
module inits (
    input clk,
    output reg q = 1'b1, output reg [3:0] count = 4'd5, output reg [7:0] o = 8'ha5,
    output reg [3:0] none
);
  always @(posedge clk) begin
    q <= ~q;
    count <= count + 1;
    o <= {o[6:0], o[7]};
    none <= none + 1;
  end
endmodule
